#!perl -p

# exponential
s/(?<!['"])\b(\d{7}[eE]\d{1})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{6}[eE]\d{2})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{5}[eE]\d{3})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{4}[eE]\d{4})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{3}[eE]\d{5})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{2}[eE]\d{6})\b(?!['"])/'$1'/g;
s/(?<!['"])\b(\d{1}[eE]\d{7})\b(?!['"])/'$1'/g;

# leading zeros
s/(?<!['"])\b(0\d{8})\b(?!['"])/'$1'/g;

# hex
s/(?<!['"])\b(0x\d{7})\b(?!['"])/'$1'/g;

# octal
s/(?<!['"])\b(0o\d{7})\b(?!['"])/'$1'/g;

__END__

ggrep --color -P '[-:]\s+\b0\d{8}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{7}[eE]\d{1}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{6}[eE]\d{2}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{5}[eE]\d{3}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{4}[eE]\d{4}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{3}[eE]\d{5}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{2}[eE]\d{6}\b' "${files[@]}"
ggrep --color -P '[-:]\s+\b\d{1}[eE]\d{7}\b' "${files[@]}"

ggrep --color -P '\b\d{1}[eE]\d{7}\b' "${files[@]}"

sed '[^\'"]\b\d{1}[eE]\d{7}\b[^\'"]' 

printf "%s: %s\n" "$(date)", "Done"
