import { AddByUrl } from '@/components/common/AddByUrl'
import { Panel } from '@/components/common/Panel'

/** The dashboard's quick-start row: AddByUrl on its own surface, above the carousel. */
export function QuickAdd() {
  return (
    <Panel className="py-3 sm:py-3">
      <AddByUrl fieldClassName="basis-[220px]" />
    </Panel>
  )
}
