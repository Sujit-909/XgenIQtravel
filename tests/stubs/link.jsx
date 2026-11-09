import React from 'react';
export default function Link({ href, children, prefetch, replace, scroll, shallow, locale, ...p }) { return React.createElement('a', { href: typeof href === 'string' ? href : href?.pathname, ...p }, children); }
