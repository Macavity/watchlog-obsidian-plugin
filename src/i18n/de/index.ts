import type en from '../en';
import type { DeepPartial } from '../index';
import common from './common';
import labels from './labels';
import notices from './notices';

export default { common, labels, notices } satisfies DeepPartial<typeof en>;
