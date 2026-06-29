import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// ── Session secret check ──────────────────────────────────────────────────────
// Enforced here at startup so a misconfigured production deploy fails fast
// instead of silently using a default secret. The fallback remains in routes.ts
// for dev convenience.
const DEFAULT_SESSION_SECRET = "clr-secret-2026";
if (process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === DEFAULT_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET env var must be set to a non-default value in production",
    );
  }
}

const app = express();
const httpServer = createServer(app);

// Trust Railway's reverse proxy so req.secure works correctly for cookie settings
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // Vite handles this
    crossOriginEmbedderPolicy: false,
  }),
);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimitMessage = { error: "Too many requests, please try again later." };

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/invite/accept", registerLimiter);
app.use("/api", generalApiLimiter);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Ensure all /api/* responses are never cached by Railway's CDN
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Surrogate-Control", "no-store");
  next();
});

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  // Routes whose responses contain secrets/PII — never log their bodies.
  const SENSITIVE_PATH = /\/credentials$|^\/api\/auth\b|\/import$|email-decision|welcome-login/;
  // Field names that should be redacted if they appear in any logged body.
  const SENSITIVE_KEY = /password|secret|token|api[_-]?key|apikey|credential|bonzo|mailbox|resend/i;
  const redact = (v: any): any => {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(redact);
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : (typeof val === "object" ? redact(val) : val);
    }
    return out;
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !SENSITIVE_PATH.test(path)) {
        logLine += ` :: ${JSON.stringify(redact(capturedJsonResponse))}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
