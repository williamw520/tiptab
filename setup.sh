#!/bin/bash

# This downloads the external libraries specified in package.json,
# and set up the pkg directories.
# This is needed before running the extension.

npm install

mkdir pkg
mkdir pkg/jquery
mkdir pkg/jquery-ui
mkdir pkg/spectre.css
mkdir pkg/spark-md5

cp node_modules/jquery/dist/jquery.min.js               pkg/jquery/
cp node_modules/jquery-ui-dist/jquery-ui.min.css        pkg/jquery-ui/
cp node_modules/jquery-ui-dist/jquery-ui.min.js         pkg/jquery-ui/
cp node_modules/spectre.css/dist/spectre-exp.min.css    pkg/spectre.css/
cp node_modules/spectre.css/dist/spectre-icons.min.css  pkg/spectre.css/
cp node_modules/spectre.css/dist/spectre.min.css        pkg/spectre.css/
cp node_modules/spark-md5/spark-md5.min.js              pkg/spark-md5/
