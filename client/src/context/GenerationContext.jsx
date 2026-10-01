import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";

// The generation lives above the pages: the request keeps running while the user browses other
// sections, and «Generar preguntas» shows its state (or its result) when the user comes back.
const GenerationContext = createContext(null);
const POLL_MS = 4000;
// A test still marked as generating after this long is not resumed after a page reload.
const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const IDLE = { status: "idle" };

export function GenerationProvider({ children }) {
  // status: idle | running | done | error. «seen» tells whether «Generar preguntas» showed the outcome.
  const [generation, setGeneration] = useState(IDLE);
  const liveRequest = useRef(false);

  const start = useCallback(async (payload, { testName, requestedCount }) => {
    liveRequest.current = true;
    const startedAt = Date.now();
    setGeneration({ status: "running", testName, requestedCount, saved: 0, startedAt });
    try {
      const data = await api.generateQuestions(payload);
      setGeneration({ status: "done", test: data.test, testName: data.test.name, saved: data.questions.length, requestedCount, seen: false });
    } catch (error) {
      setGeneration((current) => ({ ...current, status: "error", error: error.message, seen: false }));
    } finally {
      liveRequest.current = false;
    }
  }, []);

  const markSeen = useCallback(() => setGeneration((current) => (current.seen === false ? { ...current, seen: true } : current)), []);
  const reset = useCallback(() => setGeneration(IDLE), []);

  // After a page reload the request is gone but the server keeps generating: pick up the test it marks
  // as GENERATING and follow it.
  useEffect(() => {
    api.questionSets().then(({ tests }) => {
      const running = tests.find((test) => test.status === "GENERATING" && Date.now() - new Date(test.created_at).getTime() < RECOVERY_WINDOW_MS);
      if (running && !liveRequest.current) {
        setGeneration({ status: "running", testId: running.id, testName: running.name, requestedCount: running.requested_count, saved: running.question_count, startedAt: new Date(running.created_at).getTime() });
      }
    }).catch(() => {});
  }, []);

  // While generating, the saved questions give the progress; without a live request the server's
  // status is also how the generation ends.
  useEffect(() => {
    if (generation.status !== "running") return undefined;
    const timer = setInterval(async () => {
      try {
        const { tests } = await api.questionSets();
        const test = generation.testId
          ? tests.find((item) => item.id === generation.testId)
          // By name first (manual_hora is unique enough); the time also covers an unnamed test, with a
          // margin for the difference between the server and browser clocks.
          : tests.find((item) => item.status === "GENERATING" && item.name === generation.testName)
            || tests.find((item) => item.status === "GENERATING" && new Date(item.created_at).getTime() >= generation.startedAt - 60_000);
        if (!test) return;
        setGeneration((current) => {
          if (current.status !== "running") return current;
          if (!liveRequest.current && test.status === "COMPLETED") return { status: "done", test, testName: test.name, saved: test.question_count, requestedCount: test.requested_count, seen: false };
          if (!liveRequest.current && test.status === "ERROR") return { ...current, status: "error", error: test.error_message || "No se pudo completar la generación", seen: false };
          return { ...current, testId: test.id, saved: test.question_count };
        });
      } catch {
        // A failed poll is retried on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [generation.status, generation.testId, generation.startedAt, generation.testName]);

  return (
    <GenerationContext.Provider value={{ generation, start, markSeen, reset }}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  return useContext(GenerationContext);
}
