const common = {
	cancel: 'Cancel',
	save: 'Save',
	delete: 'Delete',
	close: 'Close',
	add: 'Add',
	remove: 'Remove',
	edit: 'Edit',
	search: 'Search',
	loading: 'Loading…',
	none: 'None',
	// Temporary keys for the i18n core tests
	testOnlyEnglish: 'Only in English',
	testGreeting: 'Hello {name}',
	testRows: { one: '{count} row', other: '{count} rows' },
} as const;

export default common;
