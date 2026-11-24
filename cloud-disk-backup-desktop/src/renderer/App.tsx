import { useEffect } from 'react';
import { bridge } from './app/bridge';
import { cctvReceived, snapshotReceived, stateReceived, useAppDispatch, useAppSelector } from './app/store';
import { SignIn } from './features/SignIn';
import { Setup } from './features/Setup';
import { Dashboard } from './features/Dashboard';

export function App() {
  const dispatch = useAppDispatch();
  const { loaded, state } = useAppSelector((s) => s.app);

  useEffect(() => {
    void bridge.getState().then((s) => dispatch(stateReceived(s)));
    void bridge.getSnapshot().then((s) => dispatch(snapshotReceived(s)));
    const offState = bridge.onState((s) => dispatch(stateReceived(s)));
    const offSnap = bridge.onSnapshot((s) => dispatch(snapshotReceived(s)));
    void bridge.cctvSnapshot().then((s) => dispatch(cctvReceived(s)));
    const offCctv = bridge.onCctv((s) => dispatch(cctvReceived(s)));
    return () => { offState(); offSnap(); offCctv(); };
  }, [dispatch]);

  useEffect(() => { document.documentElement.dataset.platform = state?.platform ?? ''; }, [state?.platform]);

  if (!loaded || !state) return <div className="boot"><span className="spinner" /></div>;
  if (state.phase === 'signed-out') return <SignIn state={state} />;
  if (state.phase === 'setup') return <Setup state={state} />;
  return <Dashboard state={state} />;
}
