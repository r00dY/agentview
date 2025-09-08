import { useEffect, useRef } from "react";
import type { FetcherWithComponents } from "react-router";
import type { ActionResponse } from "~/lib/errors";

export function useFetcherSuccess(
  fetcher: FetcherWithComponents<ActionResponse>,
  cb: (data: any) => void
) {
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    if (
      (prevState.current === "loading" || prevState.current === "submitting") &&
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data.ok === true
    ) {
        cb(fetcher.data?.data);
      }

    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data, cb]);
}
