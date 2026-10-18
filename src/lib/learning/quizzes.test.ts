import { describe, expect, it } from "vitest";
import { grade, questionProblem, type QuestionInput } from "./quizzes";

const q = (overrides: Partial<QuestionInput> = {}): QuestionInput => ({
  prompt: "What does presence mean?",
  kind: "single",
  options: ["Being there", "Buying things", "Working late"],
  correct: [0],
  ...overrides,
});

describe("questionProblem", () => {
  it("accepts a well-formed question", () => {
    expect(questionProblem(q())).toBeNull();
    expect(questionProblem(q({ kind: "multiple", correct: [0, 2] }))).toBeNull();
  });

  it("needs a real prompt", () => {
    expect(questionProblem(q({ prompt: "  Hi " }))).toBe("Write the question.");
  });

  it("checks the options", () => {
    expect(questionProblem(q({ options: ["Only one"] }))).toMatch(/Give 2 to 6 options/);
    expect(questionProblem(q({ options: ["a", "b", "c", "d", "e", "f", "g"] }))).toMatch(/Give 2 to 6 options/);
    expect(questionProblem(q({ options: ["Yes", "  "] }))).toBe("Options can't be empty.");
    expect(questionProblem(q({ options: ["Yes", "yes "] }))).toBe("Two options are the same.");
  });

  it("checks the correct answers against the kind", () => {
    expect(questionProblem(q({ correct: [] }))).toMatch(/exactly one/);
    expect(questionProblem(q({ correct: [0, 1] }))).toMatch(/exactly one/);
    expect(questionProblem(q({ correct: [3] }))).toBe("Mark the correct answer.");
    expect(questionProblem(q({ correct: [-1] }))).toBe("Mark the correct answer.");
    expect(questionProblem(q({ kind: "multiple", correct: [] }))).toBe("Mark at least one correct option.");
    // Repeated indexes count once.
    expect(questionProblem(q({ correct: [1, 1] }))).toBeNull();
  });
});

describe("grade", () => {
  const questions = [
    { id: "q1", correctOptionIds: ["a"], explanation: "A is right." },
    { id: "q2", correctOptionIds: ["x", "z"], explanation: null },
    { id: "q3", correctOptionIds: ["m"], explanation: null },
  ];

  it("needs exactly the correct set for each question", () => {
    const result = grade(questions, { q1: ["a"], q2: ["z", "x"], q3: ["n"] }, 70);
    expect(result.results.map((r) => r.correct)).toEqual([true, true, false]);
    expect(result.scorePercent).toBe(67);
    expect(result.passed).toBe(false);
    expect(result.results[0]).toMatchObject({ chosen: ["a"], correctOptionIds: ["a"], explanation: "A is right." });
  });

  it("marks partial and extra picks wrong, and unanswered as wrong", () => {
    const result = grade(questions, { q1: ["a", "b"], q2: ["x"] }, 70);
    expect(result.results.map((r) => r.correct)).toEqual([false, false, false]);
    expect(result.scorePercent).toBe(0);
  });

  it("passes at the pass mark", () => {
    expect(grade(questions, { q1: ["a"], q2: ["x", "z"], q3: ["m"] }, 100)).toMatchObject({ scorePercent: 100, passed: true });
    expect(grade(questions, { q1: ["a"], q2: ["x", "z"] }, 67)).toMatchObject({ scorePercent: 67, passed: true });
  });

  it("never passes an empty quiz", () => {
    expect(grade([], {}, 1)).toEqual({ scorePercent: 0, passed: false, results: [] });
  });
});
