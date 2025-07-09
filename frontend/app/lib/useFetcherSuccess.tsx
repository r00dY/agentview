import { useEffect, useRef } from "react";
import type { FetcherWithComponents } from "react-router-dom";

/**
 * Runs `cb` **once** every time a submission finishes successfully
 * (idle + some data, no error).
 */
export function useFetcherSuccess<T>(
  fetcher: FetcherWithComponents<T>,
  cb: (data: T) => void
) {
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    const justFinishedSuccessfully =
      prevState.current === "loading" &&
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data.status === "success";

    if (justFinishedSuccessfully) cb(fetcher.data.data as T);

    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data, fetcher.error, cb]);
}