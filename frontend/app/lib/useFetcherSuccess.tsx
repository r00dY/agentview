import { useEffect, useRef } from "react";
import type { FetcherWithComponents } from "react-router";
import type { FormActionData, FormActionDataSuccess } from "./FormActionData";

export function useFetcherSuccess(
  fetcher: FetcherWithComponents<FormActionData>,
  cb: (data: any) => void
) {
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    const justFinishedSuccessfully =
      (prevState.current === "loading" || prevState.current === "submitting") &&
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data.status === "success";

    if (justFinishedSuccessfully) {
      cb((fetcher.data as FormActionDataSuccess).data);
    }

    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data, cb]);
}

// export function useFetcherSuccess<T>(
//   fetcher: FetcherWithComponents<T>,
//   cb: (data: T) => void
// ) {
//   const prevState = useRef(fetcher.state);

//   useEffect(() => {
//     const justFinishedSuccessfully =
//       (prevState.current === "loading" || prevState.current === "submitting") &&
//       fetcher.state === "idle" &&
//       fetcher.data &&
//       fetcher.data.status === "success";

//     if (justFinishedSuccessfully) cb(fetcher.data.data as T);

//     prevState.current = fetcher.state;
//   }, [fetcher.state, fetcher.data, fetcher.error, cb]);
// }