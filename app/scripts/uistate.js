/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";
import app from "/scripts/util/app.js";
import ui from "/scripts/util/ui.js";


// module uistate, session import and export utils
let the_module = (function() {
    "use strict";

    const module = { NAME: "uistate" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    /// public defines
    
    // Tab style for display
    const TS_IMAGE      = 0;
    const TS_TEXT       = 1;

    // Search
    const MAX_SAVED_SEARCHES = 8;

    // Display types
    const DEFAULT_DT    = "all-tabs";      // same as DT_ALL_TABS


    /// Module public functions

    function asyncSaveUiState(uiState) {
        browser.storage.local.set({ "uiState": uiState });
    }

    function pLoadUiState() {
        return browser.storage.local.get("uiState").then( objFromJson => _normalizeUiState(objFromJson.uiState) )
            .catch(e => {
                log.warn(e);
                return _normalizeUiState();  // no saved uiState exist the first time the extension runs; just initialize a default one.
            })
    }

    function _normalizeUiState(state) {
        let uiState = {};

        state = state || {};
        uiState.showTabStyle = state.showTabStyle || TS_IMAGE;
        uiState.displayType = state.displayType || DEFAULT_DT;
        uiState.searchTerms = state.searchTerms || [];
        uiState.thumbnailSize = state.thumbnailSize || 0;
        uiState.showEmptyWindows    = app.defObjVal(state, "showEmptyWindows", false);
        uiState.showEmptyContainers = app.defObjVal(state, "showEmptyContainers", true);
        uiState.windowsMinimized    = state.windowsMinimized || {};             // wid:minimized-time, the window is minimized.
        uiState.containersMinimized = state.containersMinimized || {};          // cid:minimized-time, the container is minimized.
        uiState.filterByMuted = state.filterByMuted || 0;
        uiState.filterByPinned = state.filterByPinned || 0;
        uiState.filterByHidden = state.filterByHidden || 0;
        uiState.filterByAudible = state.filterByAudible || 0;
        uiState.theme = app.defObjVal(state, "theme", ui.THEME_SYSTEM);

        uiState.savedSearch = (state.savedSearch && app.isArray(state.savedSearch)) ? state.savedSearch : [];
        if (uiState.savedSearch.length < MAX_SAVED_SEARCHES) {
            for (var i = uiState.savedSearch.length; i < MAX_SAVED_SEARCHES; i++)
                uiState.savedSearch[i] = "";
        } else if (uiState.savedSearch.length > MAX_SAVED_SEARCHES) {
            uiState.savedSearch.length = MAX_SAVED_SEARCHES;
        }

        return uiState;
    }

    //// Module public symbols
    module.asyncSaveUiState = asyncSaveUiState;
    module.pLoadUiState = pLoadUiState;

    module.TS_IMAGE = TS_IMAGE;
    module.TS_TEXT = TS_TEXT;
    module.MAX_SAVED_SEARCHES = MAX_SAVED_SEARCHES;

    log.info("module loaded");
    return module;

}());

export default the_module;

