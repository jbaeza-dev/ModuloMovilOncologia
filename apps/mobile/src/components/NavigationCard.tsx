import type Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActionCard } from './ActionCard';

export type IconName = ComponentProps<typeof Feather>['name'];

type Props = {
  title: string;
  description?: string;
  icon: IconName;
  href: Href;
  primary?: boolean;
  replace?: boolean;
  navigationMethod?: 'navigate' | 'push';
  compact?: boolean;
  layout?: 'row' | 'tile';
  tone?: 'neutral' | 'tinted' | 'warning' | 'solid';
};

export function NavigationCard({
  title,
  description,
  icon,
  href,
  primary = false,
  replace = false,
  navigationMethod = 'push',
  compact = false,
  layout = 'row',
  tone,
}: Props) {
  return (
    <ActionCard
      title={title}
      description={description}
      icon={icon}
      compact={compact}
      layout={layout}
      tone={tone ?? (primary ? 'solid' : 'neutral')}
      onPress={() => {
        if (replace) router.replace(href);
        else if (navigationMethod === 'push') router.push(href);
        else router.navigate(href);
      }}
    />
  );
}
