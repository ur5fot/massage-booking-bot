import { describe, expect, it } from "vitest";
import type { Context } from "telegraf";
import { serializeUpdates } from "../src/bot/middleware/serialize-updates.js";

function contextFor(userId: number): Context {
  return {
    from: { id: userId },
    chat: { id: userId },
  } as unknown as Context;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("serializeUpdates", () => {
  it("не даёт двум апдейтам одного пользователя идти внахлёст", async () => {
    // Регрессия: обработчики читают состояние диалога до await и пишут после,
    // поэтому два быстрых нажатия принимали решения по одному и тому же снимку.
    const middleware = serializeUpdates();
    const ctx = contextFor(1);
    const events: string[] = [];
    const first = deferred();

    const a = middleware(ctx, async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });

    const b = middleware(ctx, async () => {
      events.push("b:start");
      events.push("b:end");
    });

    // Второй апдейт не должен был начаться, пока первый висит.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(["a:start"]);

    first.resolve();
    await Promise.all([a, b]);

    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("разных пользователей не выстраивает в общую очередь", async () => {
    const middleware = serializeUpdates();
    const events: string[] = [];
    const blocker = deferred();

    const a = middleware(contextFor(1), async () => {
      events.push("a:start");
      await blocker.promise;
    });

    const b = middleware(contextFor(2), async () => {
      events.push("b:start");
    });

    await b;
    expect(events).toEqual(["a:start", "b:start"]);

    blocker.resolve();
    await a;
  });

  it("падение апдейта не блокирует очередь", async () => {
    const middleware = serializeUpdates();
    const ctx = contextFor(1);

    await expect(
      middleware(ctx, async () => {
        throw new Error("обработчик развалился");
      }),
    ).rejects.toThrow("обработчик развалился");

    const events: string[] = [];
    await middleware(ctx, async () => {
      events.push("следующий прошёл");
    });

    expect(events).toEqual(["следующий прошёл"]);
  });

  it("пропускает апдейты без пользователя или чата", async () => {
    const middleware = serializeUpdates();
    const events: string[] = [];

    await middleware({} as Context, async () => {
      events.push("прошёл");
    });

    expect(events).toEqual(["прошёл"]);
  });
});
