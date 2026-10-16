import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MoreMenu } from './MoreMenu';
import { addRecentFile, pinRecentFile } from '../utils/persistence';

const defaults = {
    onOpenFolder: vi.fn(), onOpenRecent: vi.fn(), onFind: vi.fn(),
    onReplace: vi.fn(), onFindInFiles: vi.fn(), onPrint: vi.fn(),
};

function openMenu(props: Partial<Parameters<typeof MoreMenu>[0]> = {}) {
    render(<MoreMenu {...defaults} {...props} />);
    const trigger = screen.getByRole('button', { name: 'Options' });
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
}

function recent() {
    return screen.getByRole('menuitem', { name: 'Recent' });
}

function openRecent() {
    recent().focus();
    fireEvent.keyDown(recent(), { key: 'ArrowRight' });
    return screen.getByRole('menu', { name: 'Recent files' });
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    addRecentFile('/notes/first.md', 'first.md');
    addRecentFile('/notes/second.md', 'second.md');
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('Options recent files (CHROME-06, PR #282)', () => {
    it('keeps the submenu open when a normal mouse click follows hover', () => {
        openMenu();
        fireEvent.mouseEnter(recent());
        expect(screen.getByRole('menu', { name: 'Recent files' })).toBeInTheDocument();
        fireEvent.click(recent());
        const menu = screen.getByRole('menu', { name: 'Recent files' });
        expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus();
    });

    it('opens the exact selected path once and returns focus to Options', () => {
        const trigger = openMenu();
        const menu = openRecent();
        fireEvent.click(within(menu).getByRole('menuitem', { name: /first.md/ }));
        expect(defaults.onOpenRecent).toHaveBeenCalledExactlyOnceWith('/notes/first.md');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('keeps Home, End and wrapping arrows inside the submenu', () => {
        openMenu();
        const menu = openRecent();
        const items = within(menu).getAllByRole('menuitem');
        expect(items[0]).toHaveFocus();
        fireEvent.keyDown(items[0], { key: 'End' });
        expect(items[1]).toHaveFocus();
        fireEvent.keyDown(items[1], { key: 'ArrowDown' });
        expect(items[0]).toHaveFocus();
        fireEvent.keyDown(items[0], { key: 'ArrowUp' });
        expect(items[1]).toHaveFocus();
        fireEvent.keyDown(items[1], { key: 'Home' });
        expect(items[0]).toHaveFocus();
    });

    it('skips submenu descendants when navigating the parent menu', () => {
        openMenu();
        fireEvent.mouseEnter(recent());
        recent().focus();
        fireEvent.keyDown(recent(), { key: 'ArrowDown' });
        expect(screen.getByText('Find').closest('button')).toHaveFocus();
        expect(screen.queryByRole('menu', { name: 'Recent files' })).not.toBeInTheDocument();
    });

    it('uses Left and Escape to return one level, then Escape closes Options', () => {
        const trigger = openMenu();
        openRecent();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(recent()).toHaveFocus();
        expect(screen.queryByRole('menu', { name: 'Recent files' })).not.toBeInTheDocument();
        openRecent();
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(recent()).toHaveFocus();
        expect(screen.getByRole('menu', { name: 'Options' })).toBeInTheDocument();
        fireEvent.keyDown(recent(), { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('focuses the empty submenu so Left still returns to Recent', () => {
        localStorage.clear();
        openMenu();
        const menu = openRecent();
        expect(menu).toHaveFocus();
        expect(within(menu).getByText('No recent files')).toBeInTheDocument();
        fireEvent.keyDown(menu, { key: 'ArrowLeft' });
        expect(recent()).toHaveFocus();
    });

    it('refreshes recents on every open and retains pinned ordering', () => {
        pinRecentFile('/notes/first.md');
        openMenu();
        let menu = openRecent();
        expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('first.md');
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        addRecentFile('/notes/new.md', 'new.md');
        menu = openRecent();
        expect(within(menu).getAllByRole('menuitem').map(item => item.getAttribute('title')))
            .toEqual(['/notes/first.md', '/notes/new.md', '/notes/second.md']);
    });

    it('bridges mouse travel and restores focus when a focused fly-out closes', () => {
        vi.useFakeTimers();
        openMenu();
        const menu = openRecent();
        fireEvent.mouseLeave(recent().parentElement!);
        act(() => vi.advanceTimersByTime(100));
        fireEvent.mouseEnter(menu);
        act(() => vi.advanceTimersByTime(150));
        expect(menu).toBeInTheDocument();
        fireEvent.mouseLeave(menu);
        act(() => vi.advanceTimersByTime(150));
        expect(screen.queryByRole('menu', { name: 'Recent files' })).not.toBeInTheDocument();
        expect(recent()).toHaveFocus();
    });

    it('cancels delayed closes when reopening and closes on an outside click', () => {
        vi.useFakeTimers();
        openMenu();
        let menu = openRecent();
        fireEvent.mouseLeave(menu);
        fireEvent.click(recent());
        act(() => vi.advanceTimersByTime(200));
        menu = screen.getByRole('menu', { name: 'Recent files' });
        expect(menu).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('omits a nonfunctional Recent command when no file opener is provided', () => {
        openMenu({ onOpenRecent: undefined });
        expect(screen.queryByRole('menuitem', { name: 'Recent' })).not.toBeInTheDocument();
    });

    it('clamps the fly-out when neither side fits and adapts on resize', () => {
        vi.stubGlobal('innerWidth', 600);
        vi.stubGlobal('innerHeight', 400);
        openMenu();
        const row = recent().parentElement!;
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 180, right: 410, top: 90, height: 32 } as DOMRect);
        const menu = openRecent();
        expect(menu.style.left).toBe('-172px');
        expect(menu.style.width).toBe('288px');
        expect(menu.style.top).toBe('36px');
        expect(menu.style.maxHeight).toBe('266px');
        vi.stubGlobal('innerWidth', 1000);
        fireEvent(window, new Event('resize'));
        expect(menu.style.left).toBe('234px');
        expect(menu.style.top).toBe('0px');
        vi.stubGlobal('innerWidth', 260);
        fireEvent(window, new Event('resize'));
        expect(menu.style.width).toBe('244px');
        expect(menu.style.left).toBe('-172px');
    });

    it('remeasures after a resize finishes moving the title-bar controls', () => {
        let frame: FrameRequestCallback | undefined;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            frame = callback;
            return 42;
        }));
        const cancel = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancel);
        vi.stubGlobal('innerWidth', 600);
        openMenu();
        const row = recent().parentElement!;
        const bounds = vi.spyOn(row, 'getBoundingClientRect');
        bounds.mockReturnValue({ left: 180, right: 410, top: 90, height: 32 } as DOMRect);
        const menu = openRecent();
        fireEvent(window, new Event('resize'));
        // The responsive toolbar moves after the resize listener has run.
        bounds.mockReturnValue({ left: 130, right: 360, top: 90, height: 32 } as DOMRect);
        act(() => frame?.(0));
        expect(menu.style.left).toBe('-122px');
        expect(130 + Number.parseFloat(menu.style.left)).toBe(8);
        fireEvent(window, new Event('resize'));
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(cancel).toHaveBeenCalledWith(42);
    });

});
