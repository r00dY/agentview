// In your instrumentation.ts file
import { registerOTel } from "@vercel/otel";
import { BraintrustExporter } from "@braintrust/otel";

export function register() {
  registerOTel({
    serviceName: "my-braintrust-app",
    traceExporter: new BraintrustExporter({
      parent: `project_name:${process.env.PROJECT_NAME}`,
      filterAISpans: true, // Only send AI-related spans
    }),
  });
}