import type { ConversationMessage, ConversationToolCall } from "../context/repository";
import { localDateTimeAt } from "../time/zoned";
import type { ToolRegistry } from "../tools/registry";

export type OpenRouterAgentConfig = {
  apiKey: string;
  model: string;
  timezone: string;
};

type FetchLike = typeof fetch;

type AssistantMessage = {
  role: "assistant";
  content?: string | null;
  tool_calls?: ConversationToolCall[];
};

type OpenRouterMessage = { role: "system"; content: string } | ConversationMessage;

export type AgentResponse = {
  text: string;
  messages: ConversationMessage[];
};

function systemPrompt(timezone: string, now: Date): string {
  const localNow = localDateTimeAt(now.getTime(), timezone);
  return `You are a private personal assistant used only through Signal.
Respond in concise natural Polish unless the user clearly uses another language.
No commands, prefixes, or special syntax are required from the user.

Current instant: ${now.toISOString()}
User timezone: ${timezone}
Current local date: ${localNow.date}
Current local time: ${localNow.time}

Conversation rules:
- Previous user, assistant and tool messages are the context of the current conversation.
- A short follow-up such as "13", "jutro", "rano" or "a jednak 16:30" should be interpreted against the immediately preceding exchange unless the user clearly starts a new topic.
- If a previous reminder tool call was incomplete, preserve its known arguments and complete only what the user supplied now.
- If the user corrects a reminder created earlier in this conversation, use its real id from the previous tool result. Never invent ids.

Reminder rules:
- Use tools for reminder operations. Never claim that a reminder was created or changed unless a tool succeeded.
- Distinguish the time of a real event/appointment from the time when the user should be notified.
- For an appointment/event such as "dentysta w czwartek o 13", use reminder_schedule kind="event" and put 13:00 in eventTime, not reminderTime.
- Event reminders default to 30 minutes before the event when the user gives no reminder timing. Leave reminderDate, reminderTime, reminderDaypart and minutesBefore null to use that default.
- If the user explicitly says "30 minut wcześniej", use minutesBefore=30.
- If the user says "rano", "po południu" or "wieczorem", use reminderDaypart. The application maps morning=08:00, afternoon=15:00, evening=19:00.
- For a standalone request such as "przypomnij mi jutro o 13 zadzwonić", use kind="standalone"; reminderDate/reminderTime are the notification itself and eventDate/eventTime are null.
- Reminder tool date/time fields are local wall-clock values in the configured user timezone. The application, not you, resolves UTC offsets and DST.
- Interpret relative dates such as today/tomorrow from Current local date, not from UTC.
- If reminder details are incomplete, call reminder_schedule with null for genuinely missing fields. The tool will ask one focused clarification and the next user message will have the previous tool call in conversation history.
- When updating a reminder, preserve fields the user did not change. The application also preserves the existing notification rule when no notification field is supplied.
- If the user abandons an unfinished request, simply acknowledge it; there is no pending server-side action to cancel.
- Tool errors are authoritative. Correct the call if possible; otherwise explain the problem briefly.
- Destructive operations are unavailable and must not be simulated.
- Keep ordinary answers short and useful.`;
}

export class OpenRouterAgentClient {
  constructor(
    private readonly config: OpenRouterAgentConfig,
    private readonly tools: ToolRegistry,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async respond(input: {
    text: string;
    ownerKey: string;
    sourceMessageKey: string;
    history: ConversationMessage[];
    now?: Date;
  }): Promise<AgentResponse> {
    const now = input.now ?? new Date();
    const userMessage: ConversationMessage = { role: "user", content: input.text };
    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt(this.config.timezone, now) },
      ...input.history,
      userMessage,
    ];
    const newMessages: ConversationMessage[] = [userMessage];

    let toolCallIndex = 0;
    for (let round = 0; round < 4; round += 1) {
      const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          provider: { require_parameters: true },
          tool_choice: "auto",
          tools: this.tools.definitions(),
          messages,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`);
      }

      const payload = (await response.json()) as { choices?: Array<{ message?: AssistantMessage }> };
      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("OpenRouter returned no assistant message");

      const calls = message.tool_calls ?? [];
      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: message.content ?? null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      };

      if (calls.length === 0) {
        const content = message.content?.trim();
        if (!content) throw new Error("OpenRouter returned an empty assistant response");
        newMessages.push(assistantMessage);
        return { text: content, messages: newMessages };
      }

      messages.push(assistantMessage);
      newMessages.push(assistantMessage);

      const directReplies: string[] = [];
      let everyCallHasDirectReply = true;
      for (const call of calls) {
        const result = await this.tools.execute(call.function.name, call.function.arguments, {
          ownerKey: input.ownerKey,
          sourceMessageKey: input.sourceMessageKey,
          toolCallIndex,
          nowMs: now.getTime(),
        });
        toolCallIndex += 1;

        if (result.directReply) directReplies.push(result.directReply);
        else everyCallHasDirectReply = false;

        const toolMessage: ConversationMessage = {
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        };
        messages.push(toolMessage);
        newMessages.push(toolMessage);
      }

      if (everyCallHasDirectReply && directReplies.length === calls.length) {
        const text = directReplies.join("\n");
        newMessages.push({ role: "assistant", content: text });
        return { text, messages: newMessages };
      }
    }

    throw new Error("OpenRouter tool loop exceeded the four-round safety limit");
  }
}
