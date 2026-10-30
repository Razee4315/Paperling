import { useSyncExternalStore } from "react";
import { encodingLabel, subscribeEncodings } from "../utils/fileIO";

/** The status-bar name of `path`'s encoding, null for plain UTF-8. ENC-05. */
export function useEncodingLabel(path: string | null): string | null {
    return useSyncExternalStore(subscribeEncodings, () => encodingLabel(path));
}
