/** Shared AI error type so transport and feature modules can stay acyclic. */
export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "network" | "response" | "schema",
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "AIParseError";
  }
}
