import type en from '../en';
import type { DeepPartial } from '../index';
import common from './common';
import labels from './labels';

export default { common, labels } satisfies DeepPartial<typeof en>;
