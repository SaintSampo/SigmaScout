import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // 07-UAT.md G-6: `justify-center` (plain) centers this flex container's
  // items even while the container itself overflows its own scroll region
  // (measured live: strip scrollWidth 358px > clientWidth 342px at 390px) —
  // centered overflow pushes the LEADING tab past the scroll origin, which a
  // native horizontal scroller can never reach (there is no negative
  // scrollLeft). `justify-center-safe` (`justify-content: safe center`) is
  // the CSS Box Alignment spec's own answer to exactly this shape: center
  // when the content fits, fall back to start-alignment the moment it would
  // overflow — conditional centering with no JS measurement needed.
  "group/tabs-list inline-flex w-fit items-center justify-center-safe rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none " +
    // Task 4 (260902-ixg): the `line` variant no longer accepts the shared
    // fixed `h-8` (32px). Measured live: every `line`-variant trigger on the
    // event/team pages carries `.tap-target`'s `min-height: 44px`, 12px
    // taller than an `h-8` list — the list centred that overflow, and the
    // first `:hover`-triggered style recalc visibly snapped the strip from
    // y=235 to y=232. `h-auto!` makes the trigger's own (now also
    // auto-height, see `TabsTrigger` below) content height the SOLE
    // authority over the list's height, ending the circular dependency.
    // `py-0!` removes the base `p-[3px]`'s vertical component for `line`
    // only (horizontal padding is untouched) so the list's rendered height
    // equals the trigger's exactly, not the trigger plus 6px of superfluous
    // list chrome the trigger's own `py-0.5` (inside its 44px tap target)
    // already accounts for. `!important` is load-bearing throughout: none
    // of these overrides share a modifier prefix with the base utility they
    // replace, so Tailwind/Lightning CSS give no cascade-order guarantee
    // between them without it.
    "data-[variant=line]:h-auto! data-[variant=line]:py-0!",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // 07-UAT.md G-5: the base `flex-1` above force-equalizes every
        // trigger in this list to an identical box width regardless of its
        // own label's width (measured live: every box forced to 67px while
        // label text varied 36-76px, and "Breakdown"'s own 76px text
        // overflowed its 67px box). `line`-variant triggers (the tab strip
        // this bug was found on) instead size to their own content — padding
        // (`px-1.5`) and the list's own `gap-1` are already uniform, so a
        // content-sized trigger is what makes the VISUAL gap between labels
        // uniform too. Scoped to `variant=line` only (the one variant this
        // codebase actually renders in a scrollable strip) rather than
        // changed unconditionally, so a future `default`-variant segmented
        // control (which legitimately wants equal-width children) is
        // unaffected.
        //
        // Task 4 (260902-ixg): `h-[calc(100%-1px)]` above computes against
        // `TabsList`'s height — a percentage anchored to a container whose
        // own height this same trigger's `.tap-target` min-height (44px)
        // then overflows (measured live: list 32px, trigger 44px on the
        // event/team pages). `h-auto!` breaks that circularity: the
        // trigger's rendered height comes ONLY from its content plus
        // `.tap-target`'s min-height, never from a percentage of a
        // shorter parent, so there is nothing left for a `:hover`-forced
        // style recalc to visibly snap. Also narrowed `transition-all`
        // above to `transition-colors` (the only property this trigger
        // legitimately animates — the underline's opacity has its own
        // scoped `after:transition-opacity` below) so that if a future
        // change ever reintroduces a real layout shift here, it renders
        // instantaneously instead of animating into a visible jump.
        "group-data-[variant=line]/tabs-list:h-auto!",
        "group-data-[variant=line]/tabs-list:flex-none",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
