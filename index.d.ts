import type React from 'react'

declare module 'react' {
  interface StyleHTMLAttributes<T> extends React.HTMLAttributes<T> {
    href?: string;
    precedence?: 'low' | 'medium' | 'high';
  }
}