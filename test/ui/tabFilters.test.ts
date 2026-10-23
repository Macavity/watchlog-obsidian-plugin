import { describe, it, expect } from 'vitest';
import { buildFilterSections, buildRatingOpts, formatRatingOpt, type CommonFilterDraft } from '../../src/ui/TabFilters';

const draft = (): CommonFilterDraft => ({
	statusExclude: new Set(),
	ratingExclude: new Set(),
	priorityExclude: new Set(),
	groupExclude: new Set(),
	filterRatingEmptyOnly: false,
	filterRecentlyArrivedOnly: false,
	filterGroupsOnly: false,
});

describe('buildRatingOpts', () => {
	it('lists whole stars only when no half rating is present', () => {
		expect(buildRatingOpts([0, 3, 4])).toEqual(['1★', '2★', '3★', '4★', '5★']);
	});

	it('inserts a half option before its whole star, only for present ratings', () => {
		// i - 0.5 is checked per whole star: 0.5 precedes 1★, 4.5 precedes 5★
		expect(buildRatingOpts([4.5, 0.5])).toEqual(['0.5★', '1★', '2★', '3★', '4★', '4.5★', '5★']);
	});
});

describe('formatRatingOpt', () => {
	it('renders halves as fractions', () => {
		expect(formatRatingOpt('0.5★')).toBe('½★');
		expect(formatRatingOpt('4.5★')).toBe('4½★');
		expect(formatRatingOpt('3★')).toBe('3★');
	});
});

describe('buildFilterSections', () => {
	const base = (over: Partial<Parameters<typeof buildFilterSections>[0]> = {}) => {
		const d = draft();
		const sections = buildFilterSections({
			lead: [{ label: 'Type', opts: ['a'], excludeSet: new Set() }],
			statusOpts: ['s'],
			ratingOpts: ['1★'],
			priorities: [],
			groupOpts: [],
			draft: d,
			...over,
		});
		return { d, sections };
	};

	it('orders lead, Status, Rating, Priority and omits Group without groups', () => {
		expect(base().sections.map((s) => s.label)).toEqual(['Type', 'Status', 'Rating', 'Priority']);
	});

	it('puts middle sections before Group and adds Group when groups exist', () => {
		const { sections } = base({
			middle: [{ label: 'Platform', opts: ['p'], excludeSet: new Set() }],
			groupOpts: ['g'],
		});
		expect(sections.map((s) => s.label)).toEqual(['Type', 'Status', 'Rating', 'Priority', 'Platform', 'Group']);
	});

	it('binds the special toggles to the draft', () => {
		const { d, sections } = base({ groupOpts: ['g'] });
		const status = sections.find((s) => s.label === 'Status')!.specials![0]!;
		expect(status.resetOnGlobal).toBe(true);
		status.set(true);
		expect(d.filterRecentlyArrivedOnly).toBe(true);
		const rating = sections.find((s) => s.label === 'Rating')!;
		rating.specials![0]!.set(true);
		expect(d.filterRatingEmptyOnly).toBe(true);
		expect(rating.formatOpt).toBe(formatRatingOpt);
		const group = sections.find((s) => s.label === 'Group')!.specials![0]!;
		group.set(true);
		expect(d.filterGroupsOnly).toBe(true);
		expect(group.mode).toBe('independent');
	});

	it('shares the draft exclude sets with the sections', () => {
		const { d, sections } = base();
		expect(sections.find((s) => s.label === 'Status')!.excludeSet).toBe(d.statusExclude);
		expect(sections.find((s) => s.label === 'Priority')!.excludeSet).toBe(d.priorityExclude);
	});
});
