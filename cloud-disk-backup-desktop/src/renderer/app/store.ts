import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { AppState, CctvSnapshot, EngineSnapshot } from '../../shared/types';

const emptySnapshot: EngineSnapshot = { status: 'idle', message: null, queued: 0, transfers: [], sources: [], activity: [], uploadedFiles: 0, uploadedBytes: 0 };

/** App state mirrored from the main process (session, device, settings). */
const appSlice = createSlice({
  name: 'app',
  initialState: { loaded: false, state: null as AppState | null },
  reducers: {
    stateReceived(s, a: PayloadAction<AppState>) { s.loaded = true; s.state = a.payload; },
  },
});

/** Live backup progress from the engine. */
const engineSlice = createSlice({
  name: 'engine',
  initialState: emptySnapshot,
  reducers: {
    snapshotReceived: (_s, a: PayloadAction<EngineSnapshot>) => a.payload,
  },
});

/** Live CCTV recording state from the main process. */
const cctvSlice = createSlice({
  name: 'cctv',
  initialState: { ffmpegPath: null, cameras: [], spoolBytes: 0, activity: [] } as CctvSnapshot,
  reducers: { cctvReceived: (_s, a: PayloadAction<CctvSnapshot>) => a.payload },
});

export type View = 'overview' | 'cameras' | 'activity' | 'settings';
const uiSlice = createSlice({
  name: 'ui',
  initialState: { view: 'overview' as View },
  reducers: { viewChanged(s, a: PayloadAction<View>) { s.view = a.payload; } },
});

export const { stateReceived } = appSlice.actions;
export const { snapshotReceived } = engineSlice.actions;
export const { viewChanged } = uiSlice.actions;
export const { cctvReceived } = cctvSlice.actions;

export const store = configureStore({
  reducer: { app: appSlice.reducer, engine: engineSlice.reducer, cctv: cctvSlice.reducer, ui: uiSlice.reducer },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
