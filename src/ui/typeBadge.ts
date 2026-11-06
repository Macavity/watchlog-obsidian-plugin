import { typeLabel } from '../i18n/labels';
import { getThemedColor, type WatchLogPluginSettings } from '../types';

/** The small type badge: a themed coloured pill when `coloredTypeBadges` is on, plain text otherwise. */
export function renderTypeBadge(
	parent: HTMLElement,
	typeName: string,
	settings: Pick<WatchLogPluginSettings, 'types' | 'coloredTypeBadges' | 'colorTheme'>,
): HTMLSpanElement {
	const colored = settings.coloredTypeBadges;
	const badge = parent.createSpan({
		cls: colored ? 'wl-badge wl-badge-sm' : 'wl-badge-plain',
		text: typeLabel(typeName),
	});
	const typeDef = settings.types.find((d) => d.name === typeName);
	if (colored && typeDef) badge.style.backgroundColor = getThemedColor(typeName, typeDef.color, settings.colorTheme);
	return badge;
}
