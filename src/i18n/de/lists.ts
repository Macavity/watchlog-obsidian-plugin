import type enLists from '../en/lists';
import type { DeepPartial } from '../index';

const lists = {} satisfies DeepPartial<typeof enLists>;

export default lists;
