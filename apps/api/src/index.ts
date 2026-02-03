import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { logger } from "./lib/logger";

const env = loadEnv(process.env);
const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API listening");
});

