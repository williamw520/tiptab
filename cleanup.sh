#!/bin/bash

rm -fr web-ext-artifacts
rm -fr dist
rm -fr pkg
rm package-lock.json

find . -name "*~"  -exec rm {} \;
find . -name "*#*" -exec rm {} \;

