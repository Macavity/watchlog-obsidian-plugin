import { t } from '../i18n';
import { typeNameProblem } from '../storage/VaultLayout';

/** Localized text of why a type name is unusable, or null when it is fine. */
export function typeNameProblemText(name: string): string | null {
	const problem = typeNameProblem(name);
	if (!problem) return null;
	return problem.reason === 'reserved'
		? t('ui.typeName.reserved', { name: problem.name })
		: t('ui.typeName.unsafe', { name: problem.name, safe: problem.safe });
}
