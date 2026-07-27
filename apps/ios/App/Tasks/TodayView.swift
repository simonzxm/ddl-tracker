import DDLTrackerCore
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var presentingNewTodo = false
    @State private var editingTodo: PersonalTodo?
    @State private var showingCompleted = false

    private var visibleItems: [TaskListItem] {
        model.taskItems.filter { showingCompleted || $0.state == .pending }
    }

    var body: some View {
        Group {
            if visibleItems.isEmpty {
                ContentUnavailableView {
                    Label(showingCompleted ? "没有待办" : "当前没有未完成事项", systemImage: "checkmark.circle")
                } description: {
                    Text("添加个人待办，或关注课程教学班以查看共享 DDL。")
                } actions: {
                    Button("新建待办") { presentingNewTodo = true }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    ForEach(visibleItems) { item in
                        TaskRow(item: item)
                            .contentShape(Rectangle())
                            .onTapGesture { editIfPersonal(item) }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                completionAction(for: item)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if let todoID = item.personalTodoID,
                                   let todo = model.projection.personalTodos[todoID] {
                                    Button("删除", role: .destructive) {
                                        Task { await model.deletePersonalTodo(todo) }
                                    }
                                    Button("编辑") { editingTodo = todo }
                                        .tint(.blue)
                                }
                            }
                    }
                }
            }
        }
        .navigationTitle("待办")
        .safeAreaInset(edge: .bottom) {
            SyncStatusView()
                .padding(.horizontal)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(.bar)
        }
        .refreshable { await model.synchronize() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Toggle("显示已完成与已忽略", isOn: $showingCompleted)
                } label: {
                    Label("筛选", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { presentingNewTodo = true } label: {
                    Label("新建待办", systemImage: "plus")
                }
                Button {
                    Task { await model.synchronize() }
                } label: {
                    if model.isSyncing { ProgressView() } else { Label("同步", systemImage: "arrow.clockwise") }
                }
                .disabled(model.isSyncing)
            }
        }
        .sheet(isPresented: $presentingNewTodo) {
            PersonalTodoEditor()
        }
        .sheet(item: $editingTodo) { todo in
            PersonalTodoEditor(todo: todo)
        }
    }

    @ViewBuilder
    private func completionAction(for item: TaskListItem) -> some View {
        if item.state == .completed {
            Button("重新打开") {
                Task { await model.setTaskState(item, state: .pending) }
            }
            .tint(.orange)
        } else {
            Button("完成") {
                Task { await model.setTaskState(item, state: .completed) }
            }
            .tint(.green)
        }
    }

    private func editIfPersonal(_ item: TaskListItem) {
        guard let todoID = item.personalTodoID else { return }
        editingTodo = model.projection.personalTodos[todoID]
    }
}
