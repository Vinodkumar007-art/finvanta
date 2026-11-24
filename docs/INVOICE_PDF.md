# Invoice PDF presentation

Sales invoice rows keep the original one-click `PDF` link, which still returns the classic English layout. `PDF options` opens an inline selector for classic, branded, or compact layouts and English or Spanish labels. The options are request parameters and do not change invoice records or company settings.

The branded and compact layouts use the existing company profile name, address, GSTIN, PAN, state code, and base currency when those values are present. No logo or new profile fields are required.

jsPDF's installed standard fonts replace non-ASCII input characters with `?` in generated output. The Spanish labels therefore use ASCII-only spelling, and user-entered non-ASCII text (including accented or non-Latin names) is not guaranteed to render. Do not select or claim support for languages/scripts that need glyphs outside the installed font repertoire.
