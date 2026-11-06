import type enGames from '../en/games';
import type { DeepPartial } from '../index';

const games = {} satisfies DeepPartial<typeof enGames>;

export default games;
