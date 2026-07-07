import { randomInt, randomUUID } from 'node:crypto'

// Effect-style service seams for everything non-deterministic: production
// uses these implementations, tests inject fixed clocks/ids/codes
// (TESTING.md: mock only time, ids, randomness).

export interface Clock {
  now(): number
}

export interface IdGenerator {
  nextId(prefix: string): string
}

export interface CodeGenerator {
  nextCode(): string
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

export const randomIdGenerator: IdGenerator = {
  nextId: (prefix) => `${prefix}_${randomUUID()}`,
}

/** Five-digit numeric game codes per SPEC.md (leading zeros allowed). */
export const randomCodeGenerator: CodeGenerator = {
  nextCode: () => String(randomInt(0, 100_000)).padStart(5, '0'),
}
