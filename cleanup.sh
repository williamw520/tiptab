#!/bin/bash

rm -fr web-ext-artifacts
rm -fr pkg
rm -fr dist

rm package-lock.json

find . -name "*~"  -exec rm {} \;
find . -name "*#*" -exec rm {} \;

