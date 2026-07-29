import worker from "../../dist/server/index.js";

export default async function handler(request, context) {
  const executionContext = {
    waitUntil(promise) {
      context.waitUntil?.(promise);
    },
    passThroughOnException() {},
  };

  const assets = {
    fetch(assetRequest) {
      return fetch(assetRequest);
    },
  };

  return worker.fetch(
    request,
    {
      ASSETS: assets,
    },
    executionContext,
  );
}
