// Supabase 业务数据访问公共入口；显式区分运行时能力与类型。
export {
  readPage,
  readAllPages,
  confirmMutationRows,
  classifyPostgrestError,
  SupabaseDataAccessError,
  planEncodedFilterBatches,
  createLatestRequestGate,
  DEFAULT_DATA_PAGE_SIZE,
  MAX_SUPPORTED_PAGE_SIZE,
  DEFAULT_MAX_CLIENT_ROWS,
  DEFAULT_ENCODED_FILTER_BUDGET,
  DEFAULT_FILTER_VALUES_PER_BATCH,
} from './dataAccess';

export type {
  PageRange,
  ExactPage,
  ReadPageOptions,
  PageResult,
  ReadAllPagesOptions,
  MutationResult,
  MutationConfirmationOptions,
  PostgrestErrorLike,
  DataAccessErrorKind,
  ClassifiedPostgrestError,
  EncodedFilterBatchOptions,
  LatestRequestTicket,
  LatestRequestGate,
} from './dataAccess';
