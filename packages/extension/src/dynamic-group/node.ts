import LogicFlow, {
  GraphModel,
  h,
  RectNode,
  handleResize,
  CallbackArgs,
} from '@logicflow/core'
import { forEach } from 'lodash-es'
import { DynamicGroupNodeModel } from './model'

import Position = LogicFlow.Position
import { rotatePointAroundCenter } from '../tools/label/utils'

export interface IDynamicGroupNodeProps {
  model: DynamicGroupNodeModel
  graphModel: GraphModel
}

export class DynamicGroupNode<
  P extends IDynamicGroupNodeProps = IDynamicGroupNodeProps,
> extends RectNode<P> {
  childrenPositionMap: Map<string, Position> = new Map()

  onNodeRotate = ({
    model,
  }: Omit<CallbackArgs<'node:rotate'>, 'e' | 'position'>) => {
    const { model: curGroup, graphModel } = this.props
    const { transformWithContainer, isRestrict } = curGroup
    const childrenPositionMap = this.childrenPositionMap
    if (!transformWithContainer || isRestrict) {
      // isRestrict限制模式下，当前model resize时不能小于占地面积
      // 由于parent:resize=>child:resize计算复杂，需要根据child:resize的判定结果来递归判断parent能否resize
      // 不符合目前 parent:resize成功后emit事件 -> 触发child:resize 的代码交互模式
      // 因此isRestrict限制模式下不支持联动(parent:resize=>child:resize)
      // 由于transformWidthContainer是控制rotate+resize，为保持transformWidthContainer本来的含义
      // parent:resize=>child:resize不支持，那么parent:rotate=>child:rotate也不支持
      return
    }
    // DONE: 目前操作是对分组内节点以节点中心旋转节点本身，而按照正常逻辑，应该是以分组中心，旋转节点（跟 Label 旋转操作逻辑一致）
    if (model.id === curGroup.id) {
      const center = { x: curGroup.x, y: curGroup.y }
      forEach(Array.from(curGroup.children), (childId) => {
        const child = graphModel.getNodeModelById(childId)

        if (child) {
          let point: Position = { x: child.x, y: child.y }
          if (childrenPositionMap.has(child.id)) {
            point = childrenPositionMap.get(child.id)!
          } else {
            childrenPositionMap.set(child.id, point)
          }

          // 弧度转角度
          let theta = model.rotate * (180 / Math.PI)
          if (theta < 0) theta += 360
          const radian = theta * (Math.PI / 180)

          const newPoint = rotatePointAroundCenter(point, center, radian)

          child.moveTo(newPoint.x, newPoint.y)
          child.rotate = model.rotate
        }
      })
    }
  }

  onNodeResize = ({
    deltaX,
    deltaY,
    index,
    model,
    preData,
  }: Omit<CallbackArgs<'node:resize'>, 'e' | 'position'>) => {
    const { model: curGroup, graphModel } = this.props
    const { transformWithContainer, isRestrict } = curGroup
    if (!transformWithContainer || isRestrict) {
      // isRestrict限制模式下，当前model resize时不能小于占地面积
      // 由于parent:resize=>child:resize计算复杂，需要根据child:resize的判定结果来递归判断parent能否resize
      // 不符合目前 parent:resize成功后emit事件 -> 触发child:resize 的代码交互模式
      // 因此isRestrict限制模式下不支持联动(parent:resize=>child:resize)
      return
    }
    if (model.id === curGroup.id) {
      // node:resize是group已经改变width和height后的回调
      // 因此这里一定得用preData（没resize改变width之前的值），而不是data/model
      const { properties } = preData
      const { width: groupWidth, height: groupHeight } = properties || {}
      forEach(Array.from(curGroup.children), (childId) => {
        const child = graphModel.getNodeModelById(childId)
        if (child) {
          // 根据比例去控制缩放dx和dy
          const childDx = (child.width / groupWidth!) * deltaX
          const childDy = (child.height / groupHeight!) * deltaY

          // child.rotate = model.rotate
          handleResize({
            deltaX: childDx,
            deltaY: childDy,
            index,
            nodeModel: child,
            graphModel,
            cancelCallback: () => {},
          })
        }
      })
    }
  }

  onNodeMouseMove = ({
    deltaX,
    deltaY,
    data,
  }: Omit<CallbackArgs<'node:mousemove'>, 'e' | 'position'>) => {
    const { model: curGroup, graphModel } = this.props
    if (data.id === curGroup.id) {
      const nodeIds = this.getNodesInGroup(curGroup, graphModel)
      graphModel.moveNodes(nodeIds, deltaX, deltaY, true)
    }
  }

  componentDidMount() {
    super.componentDidMount()
    const { eventCenter } = this.props.graphModel
    // 在 group 旋转时，对组内的所有子节点也进行对应的旋转计算
    eventCenter.on('node:rotate', this.onNodeRotate)
    // 在 group 缩放时，对组内的所有子节点也进行对应的缩放计算
    eventCenter.on('node:resize', this.onNodeResize)
    // 在 group 移动时，对组内的所有子节点也进行对应的移动计算
    eventCenter.on('node:mousemove', this.onNodeMouseMove)
  }

  /**
   * 获取分组内的节点
   * @param groupModel
   */
  getNodesInGroup(
    groupModel: DynamicGroupNodeModel,
    graphModel: GraphModel,
  ): string[] {
    let nodeIds: string[] = []
    if (groupModel.isGroup) {
      forEach(Array.from(groupModel.children), (nodeId: string) => {
        nodeIds.push(nodeId)

        const nodeModel = graphModel.getNodeModelById(nodeId)
        if (nodeModel?.isGroup) {
          nodeIds = nodeIds.concat(
            this.getNodesInGroup(
              nodeModel as DynamicGroupNodeModel,
              graphModel,
            ),
          )
        }
      })
    }
    return nodeIds
  }

  getResizeControl(): h.JSX.Element | null {
    const { resizable, isCollapsed } = this.props.model
    const showResizeControl = resizable && !isCollapsed
    return showResizeControl ? super.getResizeControl() : null
  }

  getAppendAreaShape(): h.JSX.Element | null {
    // DONE: 此区域用于初始化 group container, 即元素拖拽进入感应区域
    const { model } = this.props
    const { width, height, x, y, radius, groupAddable } = model
    if (!groupAddable) return null

    const { strokeWidth = 0 } = model.getNodeStyle()
    const style = model.getAddableOutlineStyle()

    const newWidth = width + strokeWidth + 8
    const newHeight = height + strokeWidth + 8
    return h('rect', {
      ...style,
      width: newWidth,
      height: newHeight,
      x: x - newWidth / 2,
      y: y - newHeight / 2,
      rx: radius,
      ry: radius,
    })
  }

  getCollapseIcon(sx: number, sy: number): string {
    return `M ${sx + 3},${sy + 6} ${sx + 11},${sy + 6} M${sx + 7},${sy + 2} ${
      sx + 7
    },${sy + 10}`
  }

  getExpandIcon(sx: number, sy: number): string {
    return `M ${sx + 3},${sy + 6} ${sx + 11},${sy + 6} `
  }

  // 获取操作图标（收起或展开）
  getOperateIcon(): h.JSX.Element | null {
    const { model } = this.props
    const { x, y, width, height } = model
    const sx = x - width / 2 + 10
    const sy = y - height / 2 + 10

    if (!model.collapsible) return null
    const iconPath = model?.isCollapsed
      ? this.getCollapseIcon(sx, sy)
      : this.getExpandIcon(sx, sy)

    const operateIcon = h('path', {
      fill: 'none',
      stroke: '#818281',
      strokeWidth: 2,
      'pointer-events': 'none',
      d: iconPath,
    })

    return h('g', {}, [
      h('rect', {
        height: 12,
        width: 14,
        rx: 2,
        ry: 2,
        strokeWidth: 1,
        fill: '#f4f5f6',
        stroke: '#cecece',
        cursor: 'pointer',
        x: sx,
        y: sy,
        onClick: () => {
          model.toggleCollapse(!model.isCollapsed)
        },
      }),
      operateIcon,
    ])
  }

  getShape(): h.JSX.Element | null {
    return h('g', {}, [
      this.getAppendAreaShape(),
      super.getShape(),
      this.getOperateIcon(),
    ])
  }
}

export default DynamicGroupNode
