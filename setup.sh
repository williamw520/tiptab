#!/bin/bash

# This downloads the external libraries specified in package.json,
# and set up the pkg directories.
# This is needed before running the extension.

npm install

mkdir app/pkg
mkdir app/pkg/jquery
mkdir app/pkg/jquery-ui
mkdir app/pkg/spectre.css
mkdir app/pkg/spark-md5

cp node_modules/jquery/dist/jquery.min.js               app/pkg/jquery/
cp node_modules/jquery-ui-dist/jquery-ui.min.css        app/pkg/jquery-ui/
cp node_modules/jquery-ui-dist/jquery-ui.min.js         app/pkg/jquery-ui/
cp node_modules/spectre.css/dist/spectre-exp.min.css    app/pkg/spectre.css/
cp node_modules/spectre.css/dist/spectre-icons.min.css  app/pkg/spectre.css/
cp node_modules/spectre.css/dist/spectre.min.css        app/pkg/spectre.css/
cp node_modules/spark-md5/spark-md5.min.js              app/pkg/spark-md5/
