import { bootstrap } from './stage'

// Entry: overlay bootstrapper. The stage only materializes after the SW
// confirms the extension is enabled and connected (hello → {ok}).
bootstrap()
