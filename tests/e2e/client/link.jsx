import React from 'react';
export default function Link({ href, children, ...p }) { return <a href={typeof href === 'string' ? href : href?.pathname} {...p}>{children}</a>; }
