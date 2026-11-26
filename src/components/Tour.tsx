import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import mascotWave from "../assets/mascot/mascot-wave.png";
import iconPalette from "../assets/mascot/icon-command-palette.png";
import iconPencil from "../assets/mascot/icon-pencil.png";
import iconCheck from "../assets/mascot/icon-check-badge.png";
import iconSwatches from "../assets/mascot/icon-theme-swatches.png";
import mascotRocket from "../assets/mascot/mascot-rocket.png";
import { formatShortcut } from "../config/keybindings";
import { attachFocusTrap } from "../utils/focusTrap";
import { getAutoSave } from "../utils/persistence";
import { IS_MOBILE } from "../utils/platform";
import { useI18n } from "../i18n";

interface TourProps {
    /** Called when the tour finishes or is skipped. Caller persists the done flag. */
    onClose: () => void;
    /** Opens the interactive feature guide (offered on the final step). */
    onOpenTutorial?: () => void;
}

interface Step {
    id: string;
    /** CSS selector of the element to spotlight. Omit for a centered card over a full dim. */
    target?: string;
    /** Where the card sits relative to the (padded) target rect. */
    placement: "center" | "left-of" | "below" | "above";
    image: string;
    imageAlt: string;
    /** Tailwind height class for the mascot image. */
    imageClass: string;
    title: string;
    body: string;
}

// TOUR-02: the tour used to spend its three middle steps on Files, Outline
// and the command palette, and never showed how to switch between reading and
// editing or how saving works — the two things every user does. Those are the
// tour now; the long tail gets one closing line and the interactive guide.
// Built per run so shortcuts match the platform and the saving step describes
// what this profile actually does.
const buildSteps = (t: ReturnType<typeof useI18n>["t"]): Step[] => [
    {
        id: "welcome",
        placement: "center",
        image: mascotWave,
        imageAlt: t("tour.stepWelcomeAlt"),
        imageClass: "h-32",
        title: t("tour.stepWelcomeTitle"),
        body: t("tour.stepWelcomeBody"),
    },
    {
        id: "mode",
        target: "[data-tour='mode']",
        // Bottom bar on the phone, the floating switch on desktop: both sit low.
        placement: "above",
        image: iconPencil,
        imageAlt: t("tour.stepModeAlt"),
        imageClass: "h-20",
        title: t("tour.stepModeTitle"),
        body: IS_MOBILE
            ? t("tour.stepModeBodyMobile")
            : t("tour.stepModeBodyDesktop", { shortcut: formatShortcut("toggleMode") }),
    },
    {
        id: "save",
        target: "[data-tour='save']",
        placement: "above",
        image: iconCheck,
        imageAlt: t("tour.stepSaveAlt"),
        imageClass: "h-20",
        title: getAutoSave() ? t("tour.stepSaveTitleAuto") : t("tour.stepSaveTitleManual"),
        body: getAutoSave()
            ? IS_MOBILE
                ? t("tour.stepSaveBodyAutoMobile")
                : t("tour.stepSaveBodyAutoDesktop")
            : IS_MOBILE
                ? t("tour.stepSaveBodyManualMobile")
                : t("tour.stepSaveBodyManualDesktop", { shortcut: formatShortcut("save") }),
    },
    {
        id: "look",
        target: "[data-tour='settings']",
        placement: "below",
        image: iconSwatches,
        imageAlt: t("tour.stepLookAlt"),
        imageClass: "h-20",
        title: t("tour.stepLookTitle"),
        body: IS_MOBILE
            ? t("tour.stepLookBodyMobile")
            : t("tour.stepLookBodyDesktop", { zoomIn: formatShortcut("zoomIn"), zoomOut: formatShortcut("zoomOut") }),
    },
    {
        id: "more",
        placement: "center",
        image: iconPalette,
        imageAlt: t("tour.stepMoreAlt"),
        imageClass: "h-24",
        title: t("tour.stepMoreTitle"),
        body: IS_MOBILE
            ? t("tour.stepMoreBodyMobile")
            : t("tour.stepMoreBodyDesktop", { shortcut: formatShortcut("palette") }),
    },
    {
        id: "done",
        placement: "center",
        image: mascotRocket,
        imageAlt: t("tour.stepDoneAlt"),
        imageClass: "h-32",
        title: t("tour.stepDoneTitle"),
        body: t("tour.stepDoneBody"),
    },
];

const SPOT_PAD = 8;   // breathing room around the spotlit element
const CARD_GAP = 16;  // gap between card and spotlight
const MARGIN = 16;    // minimum distance from the viewport edge

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

interface SpotRect { left: number; top: number; width: number; height: number }

export function Tour({ onClose, onOpenTutorial }: TourProps) {
    const { t } = useI18n();
    const STEPS = useMemo(() => buildSteps(t), [t]);
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState<SpotRect | null>(null);
    const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const nextRef = useRef<HTMLButtonElement>(null);

    useEffect(() => attachFocusTrap(cardRef.current), []);

    const step = STEPS[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === STEPS.length - 1;

    const measure = useCallback(() => {
        if (!step.target) {
            setRect(null);
            return;
        }
        const el = document.querySelector(step.target);
        if (!el) {
            setRect(null);
            return;
        }
        const r = el.getBoundingClientRect();
        setRect({
            left: r.left - SPOT_PAD,
            top: r.top - SPOT_PAD,
            width: r.width + SPOT_PAD * 2,
            height: r.height + SPOT_PAD * 2,
        });
    }, [step.target]);

    // Measure after a frame so any pending layout changes have settled.
    useLayoutEffect(() => {
        const raf = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(raf);
    }, [measure]);

    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    // Position the card relative to the spotlight once both are measurable.
    useLayoutEffect(() => {
        const card = cardRef.current;
        if (!card || step.placement === "center" || !rect) {
            setCardPos(null);
            return;
        }
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left: number;
        let top: number;
        if (step.placement === "left-of") {
            left = rect.left - cw - CARD_GAP;
            top = rect.top + rect.height / 2 - ch / 2;
        } else if (step.placement === "above") {
            // above, left-aligned to the target (used for the status-bar toggles
            // at the bottom edge, where "below" would fall off screen)
            left = rect.left;
            top = rect.top - ch - CARD_GAP;
        } else {
            // below, right-aligned to the target (used for the titlebar gear)
            left = rect.left + rect.width - cw;
            top = rect.top + rect.height + CARD_GAP;
        }
        setCardPos({
            left: clamp(left, MARGIN, vw - cw - MARGIN),
            top: clamp(top, MARGIN, vh - ch - MARGIN),
        });
    }, [rect, step.placement, stepIndex]);

    // Final CTA: open the interactive guide, then close the tour. Enter/→ on the
    // last step run this too, so the keyboard path matches the primary button.
    const finish = useCallback(() => {
        onOpenTutorial?.();
        onClose();
    }, [onOpenTutorial, onClose]);

    const advance = useCallback(() => {
        if (isLast) finish();
        else setStepIndex((i) => i + 1);
    }, [isLast, finish]);

    const back = useCallback(() => {
        setStepIndex((i) => Math.max(0, i - 1));
    }, []);

    // Modal keyboard handling: capture phase so app shortcuts (Ctrl+P, Ctrl+E…)
    // don't fire underneath the overlay while the tour is up.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (e.key === "Enter" || e.key === "ArrowRight") {
                e.preventDefault();
                advance();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                back();
            }
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [advance, back, onClose]);

    // Keep focus on the primary action so Enter/Space always work.
    useEffect(() => {
        nextRef.current?.focus();
    }, [stepIndex]);

    const centered = step.placement === "center" || !rect;

    return (
        <div
            className="fixed inset-0 z-[300] no-select"
            role="dialog"
            aria-modal="true"
            aria-label={t("tour.ariaLabel")}
        >
            {/* Dim layer. With a target, a spotlight hole punched via box-shadow;
                without one, a plain full dim. */}
            {rect ? (
                <div
                    className="absolute rounded-xl border border-[var(--accent)] pointer-events-none"
                    style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        boxShadow: "0 0 0 100vmax rgba(0, 0, 0, 0.55)",
                        transition: "all 0.25s ease",
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-black/55" />
            )}

            {/* Card */}
            <div
                className={centered ? "absolute inset-0 flex items-center justify-center p-6" : undefined}
                style={centered ? undefined : { position: "absolute", left: cardPos?.left ?? -9999, top: cardPos?.top ?? -9999 }}
            >
                <div
                    ref={cardRef}
                    // 400px: wide enough that the last step's three buttons
                    // ("Just start writing" / "Back" / "Open the guide") fit on
                    // one row without their labels wrapping to two lines.
                    className="w-[400px] max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-4 text-center animate-fade-in"
                >
                    <img
                        src={step.image}
                        alt={step.imageAlt}
                        draggable={false}
                        className={`${step.imageClass} w-auto object-contain`}
                    />
                    <div className="flex flex-col gap-1.5">
                        <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">{step.title}</h2>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{step.body}</p>
                    </div>

                    {/* Progress dots */}
                    <div className="flex items-center gap-1.5" aria-label={t("tour.progressAria", { current: stepIndex + 1, total: STEPS.length })}>
                        {STEPS.map((s, i) => (
                            <span
                                key={s.id}
                                className={`rounded-full transition-all duration-200 ${i === stepIndex ? "w-4 h-1.5 bg-[var(--accent)]" : "w-1.5 h-1.5 bg-[var(--border)]"}`}
                            />
                        ))}
                    </div>

                    {/* flex-wrap: on a narrow viewport the three buttons of the
                        final step cannot share one row; wrapping must beat
                        clipping out of the screen. */}
                    <div className="w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                        <button
                            onClick={onClose}
                            className="btn-press whitespace-nowrap text-sm font-medium px-4 py-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)] transition-all duration-200"
                        >
                            {isFirst || isLast ? t("tour.justStartWriting") : t("tour.skip")}
                        </button>
                        <div className="flex items-center gap-2">
                            {!isFirst && (
                                <button
                                    onClick={back}
                                    className="btn-press whitespace-nowrap text-sm font-medium px-4 py-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)] transition-all duration-200"
                                >
                                    {t("tour.back")}
                                </button>
                            )}
                            <button
                                ref={nextRef}
                                onClick={advance}
                                className="btn-press whitespace-nowrap text-sm font-medium px-4 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] hover:opacity-90 text-[var(--accent-text)] transition-all duration-200"
                            >
                                {isLast ? t("tour.openGuide") : isFirst ? t("tour.showMeAround") : t("tour.next")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
