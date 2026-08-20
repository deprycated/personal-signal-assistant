import type { AssistantIntent } from "./intent";

const ACTIONS_NOT_YET_EXECUTED = new Set<AssistantIntent["intent"]>([
  "create_note",
  "search_notes",
  "create_reminder",
  "update_reminder",
  "calendar_query",
  "calendar_create",
  "checkpoint_save",
  "checkpoint_resume",
  "plan_now",
]);

export function renderIntentResponse(result: AssistantIntent): string {
  if (result.intent === "reply") {
    return result.reply ?? "Nie mam jeszcze odpowiedzi.";
  }

  if (result.intent === "ambiguous" || result.missingInformation.length > 0) {
    return result.reply ?? `Potrzebuję jeszcze: ${result.missingInformation.join(", ")}.`;
  }

  if (ACTIONS_NOT_YET_EXECUTED.has(result.intent)) {
    return result.reply
      ? `${result.reply}\n\nNa tym etapie rozpoznaję tę akcję, ale jeszcze jej nie wykonuję.`
      : "Rozpoznałem tę akcję, ale jej wykonanie pojawi się w kolejnym etapie MVP.";
  }

  return result.reply ?? "Nie udało mi się przygotować odpowiedzi.";
}
