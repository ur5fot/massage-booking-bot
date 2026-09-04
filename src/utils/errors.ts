/** Ошибка, текст которой можно показать пользователю как есть. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Слот заняли между показом и подтверждением. */
export class SlotTakenError extends UserFacingError {
  constructor() {
    super("К сожалению, это время только что заняли.\n\nВыберите другое свободное время.");
    this.name = "SlotTakenError";
  }
}

export class ValidationError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Код PostgreSQL для нарушения exclusion constraint. */
export const PG_EXCLUSION_VIOLATION = "23P01";

/**
 * Prisma заворачивает ошибку драйвера, поэтому код приходится искать и в самой
 * ошибке, и в её причине, и в мете запроса.
 */
export function isExclusionViolation(error: unknown, depth = 0): boolean {
  if (error === null || typeof error !== "object") return false;
  // Цепочка cause в теории может замкнуться сама на себя — глубину ограничиваем.
  if (depth > 5) return false;

  const candidate = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };

  if (candidate.code === PG_EXCLUSION_VIOLATION) return true;
  if (candidate.meta?.code === PG_EXCLUSION_VIOLATION) return true;
  if (candidate.cause !== undefined && candidate.cause !== error) {
    return isExclusionViolation(candidate.cause, depth + 1);
  }

  return String((error as Error).message ?? "").includes("appointment_no_overlap");
}
