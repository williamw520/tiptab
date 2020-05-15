/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018-2020  William Wong (williamw520@gmail.com)

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


// ui module
let the_module = (function() {
    "use strict";

    const module = { NAME: "ui" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    // Theme mdoes
    const THEME_SYSTEM  = "system";     // depends on system's lighting mode
    const THEME_LIGHT   = "light";      // forced light mode
    const THEME_DARK    = "dark";       // forced dark mode
    const THEMES        = [THEME_SYSTEM, THEME_LIGHT, THEME_DARK];
    const THEME_DESC    = ["based on system's color mode", "forced light mode", "forced dark mode"];

    // System color scheme
    const SCHEME_LIGHT  = "light";
    const SCHEME_DARK   = "dark";
    const SCHEME_NO_PREF= "no-preference";

    // module public functions


    // Apply the CSS variable "--var123" to the value at the element, default to the :root level.
    function setCssVar(cssVar, value, atElementSelector) {
        let elem = document.querySelector(atElementSelector || ":root");
        elem.style.setProperty(cssVar, value);
    }

    function getCssVar(cssVar, atElementSelector) {
        let elem = document.querySelector(atElementSelector || ":root");
        return document.defaultView.getComputedStyle(elem, null).getPropertyValue(cssVar);
    }

    // Get the map of CSS variables and values starting with the prefix, e.g. ui.getCssVars("--thm-") to get the --thm-xx variables.
    function getCssVars(varPrefix, atElementSelector) {
        let elem = document.querySelector(atElementSelector || ":root");
        let styleObj = document.defaultView.getComputedStyle(elem, null);
        return Array.from(styleObj)
            .filter( name => name.startsWith(varPrefix) )
            .reduce( (map, name) => (map[name] = styleObj.getPropertyValue(name).trim(), map), {});
    }


    let darkModeQuery   = window.matchMedia("(prefers-color-scheme: dark)");
    let lightModeQuery  = window.matchMedia("(prefers-color-scheme: light)");
    let noPrefModeQuery = window.matchMedia("(prefers-color-scheme: no-preference)");

    function isSystemDarkMode()     { return darkModeQuery.matches   }
    function isSystemLightMode()    { return lightModeQuery.matches  }
    function isSystemNoPreference() { return noPrefModeQuery.matches }
    function systemColorScheme()    {
        if (isSystemLightMode()) return SCHEME_LIGHT;
        if (isSystemDarkMode())  return SCHEME_DARK;
        return SCHEME_NO_PREF;
    }

    function addSystemThemeChangedListener(callback) {
        lightModeQuery.addListener( () => isSystemLightMode() ? callback(SCHEME_LIGHT) : 0 );
        darkModeQuery.addListener(  () => isSystemDarkMode()  ? callback(SCHEME_DARK)  : 0 );
        noPrefModeQuery.addListener(() => isSystemNoPreference() ? callback(SCHEME_NO_PREF)  : 0 );
    }

    function themeIndex(theme) {
        let index = THEMES.indexOf(theme);
        return index < 0 ? 0 : index;
    }

    function nextTheme(currentTheme) {
        return THEMES[(themeIndex(currentTheme) + 1) % THEMES.length];
    }

    function themeDesc(theme) {
        return THEME_DESC[themeIndex(theme)];
    }

    function isLightMode(theme) {
        if (theme == THEME_LIGHT) {
            return true;
        } else if (theme == THEME_DARK) {
            return false;
        } else if (theme == THEME_SYSTEM) {
            if (isSystemLightMode()) {
                return true;
            } else if (isSystemDarkMode()) {
                return false;
            }
        }
        return true;
    }

    function applyThemeCssVars(theme) {
        let fromPrefix  = isLightMode(theme) ? "--lit-" : "--drk-";     // copy style value from "lit" or "drk" theme variables.
        let toPrefix    = "--thm-";                                     // apply to all variables with --thm-xx variables.
        let listPrefix  = "--lit-";
        let prefixLen   = listPrefix.length;
        let vars        = getCssVars(listPrefix);                       // list all the variables to update.

        Object.keys(vars).forEach( varName => {
            let base    = varName.substring(prefixLen);                 // get base variable name.
            let fromVar = fromPrefix + base;                            // build the from-variable name.
            let toVar   = toPrefix + base;                              // build the to-variable name.
            let value   = getCssVar(fromVar);                           // get the from-value.
            setCssVar(toVar, value);                                    // set the to-value.
        });
    }


    function stopEvent(evt) {
        if (evt) {
            if (evt.stopPropagation)
                evt.stopPropagation();
            if (evt.cancelBubble != null)
                evt.cancelBubble = true;

            if (evt.preventDefault)
                evt.preventDefault();
            evt.returnValue = false;
        }
        return false;
    }


    // Module export
    module.THEME_SYSTEM = THEME_SYSTEM;
    module.THEME_LIGHT  = THEME_LIGHT;
    module.THEME_DARK   = THEME_DARK;
    module.THEMES       = THEMES;

    module.setCssVar = setCssVar;
    module.getCssVar = getCssVar;
    module.getCssVars = getCssVars;
    module.isSystemDarkMode = isSystemDarkMode;
    module.isSystemLightMode = isSystemLightMode;
    module.isSystemNoPreference = isSystemNoPreference;
    module.systemColorScheme = systemColorScheme;
    module.addSystemThemeChangedListener = addSystemThemeChangedListener;
    module.nextTheme = nextTheme;
    module.themeDesc = themeDesc;
    module.applyThemeCssVars = applyThemeCssVars;
    module.stopEvent = stopEvent;

    log.info("module loaded");
    return module;

}());

export default the_module;

