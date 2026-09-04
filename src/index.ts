import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";

const bootLogger = createLogger("info", { scope: "bootstrap" });

async function main(): Promise<void> {
  const app = createApp();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.stop(signal).finally(() => process.exit(0));
    });
  }

  await app.start();
}

main().catch((error: unknown) => {
  bootLogger.error("Не удалось запустить бота", {
    err: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
