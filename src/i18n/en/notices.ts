const notices = {
	manager: {
		editLost: 'An edit of "{id}" was not saved: its note can no longer be read.',
		invalidYaml: 'Could not update "{file}": its frontmatter is not valid YAML.',
		renameTargetExists: '"{target}" already exists; the note keeps its old file name.',
		apiKeyNeeded: 'API key needed to load episodes',
		episodesLoading: 'Episodes of "{title}" are still loading.',
		sharedConfigUnreadable: 'Watchlog: the settings block in WatchLog.base is unreadable; settings were not saved.',
	},
} as const;

export default notices;
