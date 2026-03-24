import pino from "pino";

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard"
            }
          }
  });
}
