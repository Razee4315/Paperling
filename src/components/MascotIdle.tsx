import { useState } from "react";
import blinkOpen from "../assets/mascot/mascot-blink-open.png";
import blinkClosed from "../assets/mascot/mascot-blink-closed.png";

interface MascotIdleProps {
    className?: string;
}

/**
 * The welcome mascot. Completely still, with one micro-interaction: its eyes
 * close while hovered. An earlier version waved on mount, blinked on a timer,
 * and did a squash-and-stretch bounce on hover, but the pose frames have
 * slightly different proportions, so every swap read as a glitchy jump
 * instead of an animation. The two same-pose blink frames are the only swap
 * that is pixel-stable, so that's all that remains.
 */
export function MascotIdle({ className }: MascotIdleProps) {
    const [hovered, setHovered] = useState(false);

    return (
        <img
            src={hovered ? blinkClosed : blinkOpen}
            alt="Paperling mascot"
            draggable={false}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={`object-contain select-none ${className ?? ""}`}
        />
    );
}
