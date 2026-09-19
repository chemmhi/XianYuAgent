import type { ApiMode } from './contracts';
import { createMockApi } from './mockApi';
import { createLiveApi, type XianyuApi } from './xianyuApi';

export const apiMode: ApiMode = import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';

export const api: XianyuApi = apiMode === 'live'
  ? createLiveApi({
      baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
      getToken: () => window.localStorage.getItem('auth_token'),
    })
  : createMockApi();
