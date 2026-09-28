/**
 * Normalise the many shapes an error can arrive in — a Rust command rejects with
 * a plain string, a thrown JS Error carries `.message`, and some rejections are
 * neither — into a single display string. Replaces the `typeof err === "string"
 * ? err : (err as {message?: string})?.message` incantation duplicated across
 * the app. QUALITY-02.
 */
export function errMessage(err: unknown, fallback = ""): string {
    if (typeof err === "string") return err || fallback;
    if (err && typeof err === "object" && "message" in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === "string" && m) return m;
    }
    return fallback;
}
