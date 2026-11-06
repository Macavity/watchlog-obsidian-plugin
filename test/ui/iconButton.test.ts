import { describe, it, expect } from 'vitest';
import { createIconButton } from '../../src/ui/IconButton';
import { El } from '../helpers/fakeEl';

function build(opts: Parameters<typeof createIconButton>[1]): El {
	const parent = new El('root');
	return createIconButton(parent as unknown as HTMLElement, opts) as unknown as El;
}

describe('createIconButton', () => {
	it('builds a typed, labelled button with the icon', () => {
		const btn = build({ icon: 'refresh-cw', label: 'Refresh' });
		expect(btn.tag).toBe('button');
		expect(btn.attr.type).toBe('button');
		expect(btn.attr['aria-label']).toBe('Refresh');
		expect(btn.attr.title).toBe('Refresh');
		expect(btn.attr['data-icon']).toBe('refresh-cw');
		expect(btn.classes.has('wl-icon-btn')).toBe(true);
		expect(btn.text).toBe('');
	});

	it('adds the variant and extra classes', () => {
		const btn = build({ icon: 'x', label: 'Remove', variant: 'framed', cls: 'wl-foo wl-bar' });
		expect(btn.classes.has('wl-icon-btn')).toBe(true);
		expect(btn.classes.has('wl-icon-btn-framed')).toBe(true);
		expect(btn.classes.has('wl-foo')).toBe(true);
		expect(btn.classes.has('wl-bar')).toBe(true);
	});

	it('maps the sm variant to its class', () => {
		const btn = build({ icon: 'plus', label: 'Add', variant: 'sm' });
		expect(btn.classes.has('wl-icon-btn-sm')).toBe(true);
	});

	it('maps the lg variant to its class', () => {
		const btn = build({ icon: 'more-vertical', label: 'Menu', variant: 'lg' });
		expect(btn.classes.has('wl-icon-btn-lg')).toBe(true);
		expect(btn.classes.has('wl-icon-btn-framed')).toBe(false);
	});
});
